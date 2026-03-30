import { getAvailablePresets, getDefaultPresetId } from '@/lib/presets';

export async function GET() {
    const presets = getAvailablePresets(process.env.ALLOWED_PRESETS, process.env.BLOCKED_PRESETS);
    return Response.json({
        presets: presets.map((p) => ({ id: p.id, label: p.label, description: p.description })),
        defaultPresetId: getDefaultPresetId(),
    });
}
