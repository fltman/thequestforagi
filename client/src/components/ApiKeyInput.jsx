import { useState, useRef, useEffect } from 'react';
import { verifyApiKey, getStoredApiKey, setStoredApiKey } from '../lib/api';

export default function ApiKeyInput({ onVerified, compact = false }) {
  const [key, setKey] = useState(() => getStoredApiKey());
  const [status, setStatus] = useState('empty');
  const debounce = useRef(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    // Verify stored key on mount
    const stored = getStoredApiKey();
    if (stored) {
      setStatus('checking');
      verifyApiKey(stored).then(ok => {
        if (!mounted.current) return;
        if (ok) {
          setStatus('valid');
          onVerified?.(stored);
        } else {
          setStatus('invalid');
          setStoredApiKey('');
        }
      });
    }
    return () => { mounted.current = false; };
  }, []);

  const doVerify = async (value) => {
    if (!value || value.length < 10) {
      setStatus('empty');
      setStoredApiKey('');
      return;
    }
    setStatus('checking');
    const ok = await verifyApiKey(value);
    if (!mounted.current) return;
    if (ok) {
      setStatus('valid');
      setStoredApiKey(value);
      onVerified?.(value);
    } else {
      setStatus('invalid');
      setStoredApiKey('');
    }
  };

  const scheduleVerify = (value) => {
    if (debounce.current) clearTimeout(debounce.current);
    if (!value) {
      setStatus('empty');
      setStoredApiKey('');
      return;
    }
    setStatus('checking');
    debounce.current = setTimeout(() => doVerify(value), 500);
  };

  const handleChange = (e) => {
    setKey(e.target.value);
    scheduleVerify(e.target.value);
  };

  const handlePaste = (e) => {
    const pasted = e.clipboardData.getData('text').trim();
    if (pasted) {
      e.preventDefault();
      setKey(pasted);
      if (debounce.current) clearTimeout(debounce.current);
      doVerify(pasted);
    }
  };

  const icon = status === 'checking'
    ? <span className="animate-pulse text-zinc-500">...</span>
    : status === 'valid'
    ? <span className="text-green-500">&#10003;</span>
    : status === 'invalid'
    ? <span className="text-blood">&#10007;</span>
    : null;

  const statusText = status === 'checking' ? 'Verifierar...'
    : status === 'valid' ? 'Nyckel giltig'
    : status === 'invalid' ? 'Ogiltig nyckel'
    : null;

  const statusColor = status === 'checking' ? 'text-zinc-500'
    : status === 'valid' ? 'text-green-500'
    : status === 'invalid' ? 'text-blood'
    : 'text-zinc-600';

  const inputProps = {
    type: 'password',
    value: key,
    onChange: handleChange,
    onPaste: handlePaste,
    placeholder: 'sk-or-...',
  };

  if (compact) {
    return (
      <div>
        <label className="block font-mono text-[11px] text-zinc-400 mb-1">
          OpenRouter API-nyckel
        </label>
        <div className="relative">
          <input
            {...inputProps}
            className="w-full bg-noir-900 border border-noir-600 rounded px-2 py-1.5 pr-7 font-mono text-xs text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
          />
          {icon && (
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px]">{icon}</span>
          )}
        </div>
        {statusText && (
          <p className={`font-mono text-[10px] mt-1 ${statusColor}`}>{statusText}</p>
        )}
      </div>
    );
  }

  return (
    <div className="w-full bg-noir-800/80 border border-clue/30 rounded-lg p-4 backdrop-blur-sm">
      <p className="font-mono text-xs text-clue mb-2">OpenRouter API-nyckel krävs</p>
      <div className="relative">
        <input
          {...inputProps}
          className="w-full bg-noir-900 border border-noir-600 rounded px-3 py-2 pr-8 font-mono text-xs text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-clue/50"
        />
        {icon && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm">{icon}</span>
        )}
      </div>
      <p className={`font-mono text-[10px] mt-1.5 ${statusColor}`}>
        {statusText || 'Hämta din nyckel på openrouter.ai/keys'}
      </p>
    </div>
  );
}
