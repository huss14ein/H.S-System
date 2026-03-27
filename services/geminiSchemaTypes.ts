import type { Type } from '@google/genai';

/**
 * Same string values as `@google/genai` `Type` enum, typed as `Type` for SDK compatibility
 * without importing the SDK runtime into the browser (avoids Netlify secrets scan on minified output).
 */
export const SchemaType = {
    TYPE_UNSPECIFIED: 'TYPE_UNSPECIFIED' as Type,
    STRING: 'STRING' as Type,
    NUMBER: 'NUMBER' as Type,
    INTEGER: 'INTEGER' as Type,
    BOOLEAN: 'BOOLEAN' as Type,
    ARRAY: 'ARRAY' as Type,
    OBJECT: 'OBJECT' as Type,
    NULL: 'NULL' as Type,
} as const;
