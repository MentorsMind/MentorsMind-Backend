/**
 * Federation directives and subgraph metadata (issue #866).
 *
 * Federation is fundamentally a set of claims each subgraph makes about types:
 * which it owns, which it extends, and how an entity is identified across
 * boundaries. These are those claims, expressed as data so the compositor can
 * validate them before anything is served.
 */

export const FEDERATION_DIRECTIVES = `
  directive @key(fields: String!) on OBJECT | INTERFACE
  directive @external on FIELD_DEFINITION
  directive @requires(fields: String!) on FIELD_DEFINITION
  directive @provides(fields: String!) on FIELD_DEFINITION
  directive @extends on OBJECT | INTERFACE
  directive @shareable on OBJECT | FIELD_DEFINITION
`;

export interface EntityKey {
  typeName: string;
  /** Field(s) identifying the entity, e.g. "id". */
  fields: string;
}

export interface SubgraphDefinition {
  name: string;
  /** Where the subgraph's GraphQL endpoint lives. */
  url: string;
  /** SDL for this subgraph. */
  sdl: string;
  /** Entities this subgraph owns and can resolve by key. */
  entities: EntityKey[];
  /** Types this subgraph extends but does not own. */
  extendedTypes: string[];
}

/** Parse `@key(fields: "...")` claims out of SDL. */
export function extractEntityKeys(sdl: string): EntityKey[] {
  const keys: EntityKey[] = [];
  const pattern = /type\s+(\w+)[^{]*@key\s*\(\s*fields:\s*"([^"]+)"\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(sdl)) !== null) {
    keys.push({ typeName: match[1], fields: match[2] });
  }
  return keys;
}

/** Parse types declared with `@extends` or `extend type`. */
export function extractExtendedTypes(sdl: string): string[] {
  const types = new Set<string>();

  const extendKeyword = /extend\s+type\s+(\w+)/g;
  let match: RegExpExecArray | null;
  while ((match = extendKeyword.exec(sdl)) !== null) types.add(match[1]);

  const extendsDirective = /type\s+(\w+)[^{]*@extends/g;
  while ((match = extendsDirective.exec(sdl)) !== null) types.add(match[1]);

  return [...types];
}

/** Object type names defined in an SDL document. */
export function extractObjectTypes(sdl: string): string[] {
  const types = new Set<string>();
  const pattern = /(?:^|\n)\s*(?:extend\s+)?type\s+(\w+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(sdl)) !== null) types.add(match[1]);
  return [...types];
}
