import useSWR from 'swr';

export type PresetOption = { id: string; label: string; description?: string };

export function usePresets() {
	return useSWR<PresetOption[]>(
		'/api/presets',
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
