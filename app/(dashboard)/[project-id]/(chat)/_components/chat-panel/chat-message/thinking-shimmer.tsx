import { ShimmerText } from '@/components/ui/shimmer-text';

type ThinkingShimmerProps = {
    label?: string;
};

// Used as the pre-stream placeholder, the inline "waiting on first token" indicator, and the production thinking block header. Keeping one component prevents the visual jump that happens when separate dot/typing components hand off to each other.
export function ThinkingShimmer({ label = 'Thinking' }: ThinkingShimmerProps) {
    return (
        <div className="mb-2 py-2 text-sm text-muted-foreground/70">
            <ShimmerText className="font-medium">{label}</ShimmerText>
        </div>
    );
}
