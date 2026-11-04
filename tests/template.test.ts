import { describe, expect, it } from 'vitest';
import { parseTemplateVariables, renderTemplate } from '../src/shared/template.js';

describe('parseTemplateVariables', () => {
    it('finds unique placeholders in order and keeps repeats', () => {
        const parsed = parseTemplateVariables('Hello %name%, %ticket_id% and %name% again.');
        expect(parsed.names).toEqual(['name', 'ticket_id', 'name']);
        expect(parsed.uniqueNames).toEqual(['name', 'ticket_id']);
    });

    it('ignores malformed or invalid placeholders', () => {
        const text = '100% sure, %1abc%, %has space%, %, %%, trailing %oops';
        expect(parseTemplateVariables(text).uniqueNames).toEqual([]);
    });

    it('accepts underscores and digits after the first character', () => {
        expect(parseTemplateVariables('%_a1% %Customer_Name%').uniqueNames).toEqual(['_a1', 'Customer_Name']);
    });
});

describe('renderTemplate', () => {
    it('replaces every occurrence of a repeated variable consistently', () => {
        const result = renderTemplate('%name% / %name% / %name%', { name: 'Ada' });
        expect(result.text).toBe('Ada / Ada / Ada');
        expect(result.missing).toEqual([]);
    });

    it('reports missing and empty values and leaves their placeholders visible', () => {
        const result = renderTemplate('Hi %name% — %ticket_id% — %other%', { name: 'Ada', ticket_id: '' });
        expect(result.text).toBe('Hi Ada — %ticket_id% — %other%');
        expect(result.missing).toEqual(['ticket_id', 'other']);
    });

    it('preserves line breaks and whitespace exactly', () => {
        const content = 'Hello %name%,\r\n\r\n  indented\t%name%  \n';
        expect(renderTemplate(content, { name: 'Bo' }).text).toBe('Hello Bo,\r\n\r\n  indented\tBo  \n');
    });

    it('treats values as literal text: punctuation, percent signs, unicode, newlines, $ patterns', () => {
        const value = '50% off $& $1 %other% 日本語 🎉\nline two';
        const result = renderTemplate('A: %msg% B: %other%', { msg: value, other: 'x' });
        expect(result.text).toBe(`A: ${value} B: x`);
    });

    it('does not mutate the template or the values object', () => {
        const content = 'Hi %name%';
        const values = { name: 'Ada' };
        renderTemplate(content, values);
        expect(content).toBe('Hi %name%');
        expect(values).toEqual({ name: 'Ada' });
    });

    it('does not treat inherited object properties as values', () => {
        expect(renderTemplate('%constructor%', {}).missing).toEqual(['constructor']);
    });
});
