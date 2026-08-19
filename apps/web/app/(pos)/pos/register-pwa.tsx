'use client';

import { useEffect } from 'react';

export function RegisterPosPwa() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    void navigator.serviceWorker
      .register('/pos-sw.js', { scope: '/pos/' })
      .then((registration) => registration.update())
      .catch(() => undefined);
  }, []);

  return null;
}
