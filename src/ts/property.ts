/**
 * Copyright 2018 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import {createArrayTypeNode, createKeywordTypeNode, createPropertySignature, createStringLiteral, createToken, createTypeReferenceNode, createUnionTypeNode, HighlightSpanKind, PropertySignature, SyntaxKind, TypeNode} from 'typescript';

import {toScopedName, toTypeName} from '../triples/names';
import {Format, ObjectPredicate, TObject, TSubject} from '../triples/triple';
import {GetComment, GetType, IsDomainIncludes, IsRangeIncludes, IsSupersededBy} from '../triples/wellKnown';

import {ClassMap} from './class';
import {withComments} from './util/comments';


export class PropertyType {
  readonly types: TObject[] = [];

  constructor(readonly subject: TSubject, object?: TObject) {
    if (object) this.types.push(object);
  }

  private _comment?: string;
  private readonly _supersededBy: TObject[] = [];

  get deprecated() {
    return this._supersededBy.length > 0;
  }

  get comment() {
    if (!this.deprecated) return this._comment;
    const deprecated = `@deprecated Consider using ${
        this._supersededBy.map(o => o.toString()).join(' or ')} instead.`;

    return this._comment ? `${this._comment}\n${deprecated}` : deprecated;
  }

  add(value: ObjectPredicate, classes: ClassMap): boolean {
    const c = GetComment(value);
    if (c) {
      if (this._comment) {
        console.error(`Duplicate comments provided on property ${
            this.subject.toString()}. It will be overwritten.`);
      }
      this._comment = c.comment;
      return true;
    }
    if (GetType(value)) return true;  // We used types already.

    if (IsRangeIncludes(value.Predicate)) {
      this.types.push(value.Object);
      return true;
    }

    if (IsDomainIncludes(value.Predicate)) {
      const cls = classes.get(value.Object.toString());
      if (!cls) {
        throw new Error(
            `Could not find class for ${this.subject.name}, ${Format(value)}.`);
      }
      cls.addProp(new Property(toScopedName(this.subject), this));
      return true;
    }

    if (IsSupersededBy(value)) {
      this._supersededBy.push(value.Object);
      return true;
    }

    return false;
  }
}

export class Property {
  constructor(
      private readonly key: string, private readonly type: PropertyType) {}

  required() {
    return this.key.startsWith('@');
  }

  get deprecated() {
    return this.type.deprecated;
  }

  private typeNode() {
    const node = this.scalarTypeNode();
    return this.key.startsWith('@') ?
        node :
        createUnionTypeNode([node, createArrayTypeNode(node)]);
  }

  private scalarTypeNode() {
    const typeNodes = this.type.types.map(
        type => createTypeReferenceNode(toTypeName(type), []));
    switch (typeNodes.length) {
      case 0:
        return createKeywordTypeNode(SyntaxKind.NeverKeyword);
      case 1:
        return typeNodes[0];
      default:
        return createUnionTypeNode(typeNodes);
    }
  }

  toNode(): PropertySignature {
    return withComments(
        this.type.comment,
        createPropertySignature(
            /* modifiers= */[],
            createStringLiteral(this.key),
            this.required() ? undefined : createToken(SyntaxKind.QuestionToken),
            /*typeNode=*/this.typeNode(),
            /*initializer=*/undefined,
            ));
  }
}