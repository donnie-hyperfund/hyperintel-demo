import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MODEL_PRESETS } from '@/lib/presets';
import { useModelSelection } from '@/modules/chat/providers/model-selection-provider';

export function SwitchModelSelector({ disabled }: { disabled: boolean }) {
    const { selectedModel, setSelectedModel } = useModelSelection();

    return (
        <Select value={selectedModel} onValueChange={setSelectedModel} disabled={disabled}>
            <SelectTrigger className="h-auto gap-1 border-none bg-transparent dark:bg-transparent p-0 text-xs text-neutral-400 shadow-none hover:enabled:text-neutral-300 dark:hover:bg-transparent transition-colors focus-visible:ring-0 [&_svg]:text-current [&_svg]:transition-transform data-[state=open]:[&_svg]:rotate-180 disabled:cursor-default disabled:opacity-100">
                <SelectValue />
            </SelectTrigger>
            <SelectContent align="start">
                {MODEL_PRESETS.map((p) => (
                    <SelectItem key={p.id} value={p.id} className="text-xs">
                        {p.label}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}
