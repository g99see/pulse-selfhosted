// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import { useEffect, useRef } from 'react';

/**
 * Кнопка Telegram Login Widget (ТЗ §3.1, §7). Скрипт Telegram сам подписывает
 * данные пользователя; мы передаём их на API, который проверяет HMAC-подпись.
 * Скрипт создаётся вручную: React не исполняет <script> из JSX.
 */
export interface TelegramWidgetUser {
  id: number | string;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

declare global {
  interface Window {
    __pulsTelegramAuthUser?: (user: TelegramWidgetUser) => void;
  }
}

const WIDGET_SRC = 'https://telegram.org/js/telegram-widget.js?22';
const CALLBACK_NAME = '__pulsTelegramAuthUser';

export function TelegramLoginButton({
  botUsername,
  label,
  onAuth,
}: {
  botUsername: string;
  label: string;
  onAuth: (user: TelegramWidgetUser) => void;
}) {
  const holder = useRef<HTMLSpanElement>(null);
  const callback = useRef(onAuth);
  callback.current = onAuth;
  const labelRef = useRef(label);
  labelRef.current = label;

  useEffect(() => {
    window[CALLBACK_NAME] = (user) => callback.current(user);
    return () => {
      delete window[CALLBACK_NAME];
    };
  }, []);

  useEffect(() => {
    const container = holder.current;
    if (!container) return;

    container.replaceChildren();
    const script = document.createElement('script');
    script.src = WIDGET_SRC;
    script.async = true;
    script.setAttribute('data-telegram-login', botUsername);
    script.setAttribute('data-size', 'large');
    script.setAttribute('data-request-access', 'write');
    script.setAttribute('data-onauth', `${CALLBACK_NAME}(user)`);
    container.appendChild(script);

    // Скрипт Telegram вставляет iframe без title — у фрейма должно быть имя для
    // скринридеров (Lighthouse frame-title). Подписываем его, как только он появится.
    const observer = new MutationObserver(() => {
      const frame = container.querySelector('iframe');
      if (frame && !frame.title) frame.title = labelRef.current;
    });
    observer.observe(container, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      container.replaceChildren();
    };
  }, [botUsername]);

  // role="group": aria-label на span без роли запрещён (aria-prohibited-attr).
  return <span ref={holder} role="group" data-testid="telegram-login" aria-label={label} />;
}
