import useSWR from 'swr';
import { getWorkerUrl } from '@/lib/api/requests/worker/common';
import { CHAT_EP, WORKERS, WORKERS_LOCAL_ENDPOINTS } from '@/lib/constants/routes';
import { frontendEnv } from '@/lib/env';

export type PresetOption = { id: string; label: string; description?: string };
type PresetsResponse = { presets: PresetOption[]; defaultPresetId: string };

function getPresetsUrl(): string {
	if (!frontendEnv.NEXT_PUBLIC_LOCAL_WORKERS && frontendEnv.NEXT_PUBLIC_CLOUDFLARE_BASE) {
		return getWorkerUrl(WORKERS.Chat, CHAT_EP.Presets);
	}
	return WORKERS_LOCAL_ENDPOINTS.Presets;
}

export function usePresets() {
	return useSWR<PresetsResponse>(
		getPresetsUrl(),
		async (url: string) => {
			const res = await fetch(url);
			if (!res.ok) throw new Error('Failed to fetch presets');
			return res.json();
		},
		{
			revalidateOnFocus: true,
			refreshInterval: 5 * 60 * 1000,
			dedupingInterval: 60 * 1000,
		},
	);
}
