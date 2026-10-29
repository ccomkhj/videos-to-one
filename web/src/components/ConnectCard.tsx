import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import type { AppInfo } from '@vto/shared';
import { api } from '../api.ts';

/** "Connect your phone" card with a QR code (laptop only, SPEC §4.1). */
export function ConnectCard() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    api.info().then(setInfo, () => {});
  }, []);
  useEffect(() => {
    if (info?.phoneUrl) QRCode.toDataURL(info.phoneUrl, { margin: 1, width: 360 }).then(setQr, () => {});
  }, [info?.phoneUrl]);

  if (!info) return null;
  return (
    <div className="card connect">
      <h2>Connect your phone</h2>
      {info.phoneUrl ? (
        <>
          {qr && <img className="qr" src={qr} alt={`QR code for ${info.phoneUrl}`} />}
          <p>
            Scan with the phone's camera, or open <a href={info.phoneUrl}>{info.phoneUrl}</a>. Both devices must be on the same
            Wi-Fi.
          </p>
        </>
      ) : (
        <>
          <p>
            The phone URL is unknown because <code>PUBLIC_HOST</code> isn't set. Find this computer's LAN IP and restart with{' '}
            <code>-e PUBLIC_HOST=&lt;ip&gt;</code>, or type <code>http://&lt;ip&gt;:{location.port || 80}</code> on the phone.
          </p>
          <ul className="muted">
            <li>macOS: System Settings → Wi-Fi → Details → IP address</li>
            <li>Windows: run <code>ipconfig</code>, look for IPv4 Address</li>
            <li>Linux: run <code>hostname -I</code></li>
          </ul>
        </>
      )}
      <p className="muted small">
        Anyone on the same Wi-Fi can open this app. Stop it when you're done, especially on hotel or café networks.
      </p>
    </div>
  );
}
