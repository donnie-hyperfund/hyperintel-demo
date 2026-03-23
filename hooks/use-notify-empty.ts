import { useEffect } from 'react';

type UseNotifyEmptyOptions = {
    isEmpty: boolean;
    enabled: boolean;
    onChange?: (isEmpty: boolean) => void;
};

export function useNotifyEmpty({ isEmpty, enabled, onChange }: UseNotifyEmptyOptions) {
    useEffect(() => {
        if (enabled) {
            onChange?.(isEmpty);
        }
    }, [isEmpty, enabled, onChange]);
}
