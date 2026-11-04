/**
 * Placeholder grammar:  %name%
 *   name := [A-Za-z_][A-Za-z0-9_]{0,63}
 * A percent sign that does not open and close a valid name (for example "100% sure")
 * is left untouched. Substitution is single-pass, so values are never re-scanned
 * and a value containing "%other%" stays literal text.
 */
import type { TemplateVariable } from './types.js';

const PLACEHOLDER = /%([A-Za-z_][A-Za-z0-9_]{0,63})%/g;

export interface ParsedTemplateVariables {
    names: string[];
    uniqueNames: string[];
}

export interface RenderResult {
    text: string;
    missing: string[];
}

export function parseTemplateVariables(content: string): ParsedTemplateVariables {
    const names = [...content.matchAll(PLACEHOLDER)].map((match) => match[1]);
    return { names, uniqueNames: [...new Set(names)] };
}

/**
 * A variable counts as missing when its value is undefined or an empty string.
 * Missing placeholders are left in the text so they can never be copied silently.
 * Names listed in optional are replaced by an empty string instead of being reported missing.
 */
export function renderTemplate(content: string, values: Record<string, string | undefined>, optional: readonly string[] = []): RenderResult {
    const missing = new Set<string>();

    const text = content.replace(PLACEHOLDER, (placeholder, name: string) => {
        const value = Object.prototype.hasOwnProperty.call(values, name) ? values[name] : undefined;
        if (value === undefined || value === '') {
            if (optional.includes(name)) {
                return '';
            }
            missing.add(name);
            return placeholder;
        }

        return value;
    });

    return { text, missing: [...missing] };
}

/**
 * Applies saved variable definitions: a typed value wins over the default, and variables marked
 * not required may stay empty. Variables without a definition are required.
 */
export function renderWithDefinitions(
    content: string,
    definitions: readonly TemplateVariable[],
    values: Record<string, string | undefined>,
): RenderResult {
    const byName = new Map(definitions.map((definition) => [definition.name, definition]));
    const effective: Record<string, string | undefined> = {};
    const optional: string[] = [];

    for (const name of parseTemplateVariables(content).uniqueNames) {
        const definition = byName.get(name);
        effective[name] = Object.prototype.hasOwnProperty.call(values, name) ? values[name] : definition?.default_value;
        if (definition && !definition.required) {
            optional.push(name);
        }
    }

    return renderTemplate(content, effective, optional);
}
