import { Loader2 } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useChatContext } from '@/modules/chat/providers/chat-provider';
import { useModelSelection } from '@/modules/chat/providers/model-selection-provider';

export function SwitchModelSelector({ disabled }: { disabled: boolean }) {
    const { selectedModel, isModelAvailable, availablePresets, isChangingModel } = useModelSelection();
    const { changeModel } = useChatContext();

    return (
        <Select value={selectedModel} onValueChange={changeModel} disabled={disabled || isChangingModel}>
            <SelectTrigger className="h-auto gap-1 border-none bg-transparent dark:bg-transparent p-0 text-xs text-neutral-400 shadow-none hover:enabled:text-neutral-300 dark:hover:bg-transparent transition-colors focus-visible:ring-0 [&_svg]:text-current [&_svg]:transition-transform data-[state=open]:[&_svg]:rotate-180 disabled:cursor-default disabled:opacity-100">
                {isChangingModel ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                    <SelectValue>
                        {isModelAvailable
                            ? availablePresets.find((p) => p.id === selectedModel)?.label
                            : `${selectedModel} (unavailable)`}
                    </SelectValue>
                )}
            </SelectTrigger>
            <SelectContent align="start">
                {availablePresets.map((p) => (
                    <SelectItem key={p.id} value={p.id} className="text-xs">
                        {p.label}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}
