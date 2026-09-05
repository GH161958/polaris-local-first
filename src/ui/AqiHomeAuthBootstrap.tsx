import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import {
  authenticateAqiHome,
  subscribeAqiHomeAuthRequired,
  type AqiHomeAuthResult
} from '../app/chat/aqiHomeAuth';

const shellStyle: CSSProperties = {
  position: 'fixed',
  right: 16,
  bottom: 16,
  zIndex: 10000,
  display: 'grid',
  gap: 8,
  maxWidth: 300,
  padding: 12,
  border: '1px solid color-mix(in srgb, currentColor 16%, transparent)',
  borderRadius: 12,
  background: 'var(--cool-bg, #fff)',
  boxShadow: '0 10px 30px rgb(0 0 0 / 16%)'
};

const controlStyle: CSSProperties = {
  minHeight: 36,
  border: '1px solid color-mix(in srgb, currentColor 20%, transparent)',
  borderRadius: 8,
  padding: '6px 10px',
  color: 'inherit',
  background: 'transparent'
};

function authMessage(result: AqiHomeAuthResult) {
  if (result.ok) return 'Aqi Home 已连接';
  if (result.errorType === 'access_key_required') return '请输入 Access Key';
  if (result.errorType === 'invalid_access_key') return 'Access Key 不正确';
  return '暂时无法连接 Aqi Home';
}

export function AqiHomeAuthBootstrap() {
  const [open, setOpen] = useState(false);
  const [accessKey, setAccessKey] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => subscribeAqiHomeAuthRequired(() => {
    setMessage('请先连接 Aqi Home');
    setOpen(true);
  }), []);

  const close = () => {
    setAccessKey('');
    setMessage('');
    setOpen(false);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const submittedAccessKey = accessKey;
    setAccessKey('');
    setSubmitting(true);
    const result = await authenticateAqiHome(submittedAccessKey);
    setSubmitting(false);
    setMessage(authMessage(result));
    if (result.ok) setOpen(false);
  };

  if (!open) {
    return (
      <button
        type="button"
        style={{ ...controlStyle, position: 'fixed', right: 16, bottom: 16, zIndex: 10000 }}
        onClick={() => setOpen(true)}
      >
        {message || '连接 Aqi Home'}
      </button>
    );
  }

  return (
    <form style={shellStyle} onSubmit={submit} aria-label="Aqi Home 登录">
      <strong>Aqi Home 私人连接</strong>
      <span style={{ fontSize: 12, opacity: 0.72 }}>
        Access Key 仅用于本次登录，不会保存在 Polaris。
      </span>
      <input
        type="password"
        value={accessKey}
        disabled={submitting}
        autoComplete="off"
        autoFocus
        aria-label="Aqi Home Access Key"
        style={controlStyle}
        onChange={(event) => setAccessKey(event.target.value)}
      />
      {message ? <span role="status" style={{ fontSize: 12 }}>{message}</span> : null}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" style={controlStyle} disabled={submitting} onClick={close}>
          取消
        </button>
        <button type="submit" style={controlStyle} disabled={submitting}>
          {submitting ? '连接中…' : '登录'}
        </button>
      </div>
    </form>
  );
}
