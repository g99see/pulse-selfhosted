// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import { useEffect, useRef, useState } from 'react';
import type { Locale } from '@puls/shared';
import { useT } from '@/components/locale-provider';

/** Минимальный срез Web Speech API: типов SpeechRecognition в lib.dom нет. */
interface SpeechRecognitionEventLike {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
}

interface SpeechRecognitionWindow {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
}

const SPEECH_LANGS: Record<Locale, string> = { ru: 'ru-RU', en: 'en-US' };

function recognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null;
  const speechWindow = window as unknown as SpeechRecognitionWindow;
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}

/**
 * Кнопка микрофона (ТЗ §4, P2): распознаёт речь целиком в браузере через Web
 * Speech API — аудио никуда не уходит, наружу летит только готовый текст.
 * Язык распознавания берётся из локали интерфейса. Если API нет, кнопка
 * не показывается, а рядом остаётся подсказка.
 */
export function VoiceInputButton({
  onTranscript,
  testId,
  label,
}: {
  onTranscript: (text: string) => void;
  testId: string;
  label: string;
}) {
  const { t, locale } = useT();
  const [supported, setSupported] = useState<boolean | null>(null);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    setSupported(recognitionCtor() !== null);
  }, []);

  useEffect(
    () => () => {
      recognitionRef.current?.abort();
    },
    [],
  );

  function start(): void {
    const Ctor = recognitionCtor();
    if (!Ctor) return;

    const recognition = new Ctor();
    recognition.lang = SPEECH_LANGS[locale];
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const parts: string[] = [];
      for (let i = 0; i < event.results.length; i += 1) {
        const alternative = event.results[i]?.[0];
        if (alternative?.transcript) parts.push(alternative.transcript);
      }
      const text = parts.join(' ').trim();
      if (text) onTranscript(text);
    };
    recognition.onerror = () => {
      setError(true);
      setListening(false);
    };
    recognition.onend = () => setListening(false);

    recognitionRef.current = recognition;
    setError(false);
    setListening(true);
    try {
      recognition.start();
    } catch {
      setError(true);
      setListening(false);
    }
  }

  if (supported === false) {
    return (
      <p data-testid={`${testId}-unsupported`} className="text-xs text-[var(--puls-ink-muted)]">
        {t('checkin.voice.unsupported')}
      </p>
    );
  }
  if (supported === null) return null;

  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        data-testid={testId}
        aria-pressed={listening}
        aria-label={`${listening ? t('checkin.voice.stop') : t('checkin.voice.start')}: ${label}`}
        onClick={() => (listening ? recognitionRef.current?.stop() : start())}
        className="inline-flex min-h-11 items-center rounded-[var(--radius-chip)] bg-[var(--puls-primary-soft)] px-4 text-sm font-semibold text-[var(--puls-primary-text)]"
      >
        {listening ? t('checkin.voice.stop') : t('checkin.voice.start')}
      </button>
      {error ? (
        <span
          role="alert"
          data-testid={`${testId}-error`}
          className="text-xs text-[var(--puls-warning-text)]"
        >
          {t('checkin.voice.error')}
        </span>
      ) : null}
    </span>
  );
}
