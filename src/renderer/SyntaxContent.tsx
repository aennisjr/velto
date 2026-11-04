import hljs from 'highlight.js/lib/core';
import type { ReactNode } from 'react';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import html from 'highlight.js/lib/languages/xml';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import python from 'highlight.js/lib/languages/python';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import yaml from 'highlight.js/lib/languages/yaml';
import type { SyntaxLanguage } from '../shared/syntaxLanguages.js';

hljs.registerLanguage('bash', bash);
hljs.registerLanguage('css', css);
hljs.registerLanguage('html', html);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('python', python);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('yaml', yaml);

interface Props {
    content: string;
    isTemplate: boolean;
    language: SyntaxLanguage;
}

function renderPlainText(content: string, isTemplate: boolean): ReactNode {
    if (!isTemplate) {
        return content;
    }

    return content.split(/(%[A-Za-z_][A-Za-z0-9_]{0,63}%)/g).map((part, index) =>
        /^%[A-Za-z_][A-Za-z0-9_]{0,63}%$/.test(part) ? (
            <span key={index} className="content-variable">{part}</span>
        ) : (
            part
        ),
    );
}

export default function SyntaxContent({ content, isTemplate, language }: Props) {
    if (language === 'plaintext') {
        return <pre className="content">{renderPlainText(content, isTemplate)}</pre>;
    }

    const highlighted = hljs.highlight(content, { language }).value;
    return (
        <pre className="content syntax-highlight">
            <code dangerouslySetInnerHTML={{ __html: highlighted }} />
        </pre>
    );
}
