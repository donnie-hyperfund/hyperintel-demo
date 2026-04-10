import type { DirectiveHandler } from '@/components/ui/markdown-renderer';
import { ArtifactIndicator } from '../../artifact-indicator';

export const DocumentDirective: DirectiveHandler = ({ type, label, attributes, children }) => {
    const version = Number(attributes.version);
    const isReference = 'ref' in attributes;

    if (type === 'container') {
        return (
            <div>
                <ArtifactIndicator
                    documentName={label}
                    documentVersion={version}
                    documentType={attributes['document-type']}
                    isReference={isReference}
                />
                {children}
            </div>
        );
    }

    return (
        <ArtifactIndicator
            documentName={label}
            documentVersion={version}
            documentType={attributes['document-type']}
            isReference={isReference}
        />
    );
};
