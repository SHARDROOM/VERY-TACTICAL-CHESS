import { useEffect, useState } from 'react';

/**
 * "GM 판정 중… 12초" with the GM being asked under it (GM 속도, 사용자 요청): how long the ruling has
 * taken so far, and which model, a backup's name once the request goes on to it (예비 GM).
 * Counts from when it appears, so a guest counts from when it heard the GM was busy.
 */
export function GmBusyBadge({ name }: { name: string }) {
  const [start] = useState(() => Date.now());
  const [now, setNow] = useState(start);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const seconds = Math.floor((now - start) / 1000);
  return (
    <div className="badge busy" role="status">
      GM 판정 중… <span className="busy-seconds">{seconds}초</span>
      {name && <span className="busy-gm">{name}</span>}
    </div>
  );
}
