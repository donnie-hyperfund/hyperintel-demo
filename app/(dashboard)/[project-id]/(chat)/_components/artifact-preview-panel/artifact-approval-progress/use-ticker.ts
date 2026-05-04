import { useEffect, useState } from 'react';

export function useTicker(): number {
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        setNow(Date.now());
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, []);

    return now;
}
