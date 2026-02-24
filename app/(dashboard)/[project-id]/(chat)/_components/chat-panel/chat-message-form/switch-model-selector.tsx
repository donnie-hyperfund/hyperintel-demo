import { ANTHROPIC_MODELS } from '@common/ai/types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useModelSelection } from '@/modules/chat/providers/model-selection-provider';

const MODEL_OPTIONS: { value: ANTHROPIC_MODELS; label: string }[] = [
    { value: ANTHROPIC_MODELS.HAIKU, label: 'Haiku 4.5' },
    { value: ANTHROPIC_MODELS.SONNET, label: 'Sonnet 4.6' },
    { value: ANTHROPIC_MODELS.OPUS, label: 'Opus 4.5' },
];

export function SwitchModelSelector() {
    const { selectedModel, setSelectedModel } = useModelSelection();

    return (
        <Select value={selectedModel} onValueChange={(v) => setSelectedModel(v as ANTHROPIC_MODELS)}>
            <SelectTrigger className="h-auto gap-1 border-none bg-transparent dark:bg-transparent p-0 text-xs text-neutral-600 shadow-none hover:text-neutral-400 dark:hover:bg-transparent transition-colors focus-visible:ring-0 [&_svg]:transition-transform data-[state=open]:[&_svg]:rotate-180">
                <SelectValue />
            </SelectTrigger>
            <SelectContent align="start">
                {MODEL_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}
