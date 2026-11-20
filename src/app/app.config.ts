import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors, HttpInterceptorFn } from '@angular/common/http';

import { routes } from './app.routes';
import { safeLocalStorageGet } from './core/utils/storage.util';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const isInternalApi = req.url.startsWith('/api/') || req.url.startsWith(`${window.location.origin}/api/`);
  const token = isInternalApi ? safeLocalStorageGet('jeopardy_token') : null;
  if (token) {
    const cloned = req.clone({
      setHeaders: {
        Authorization: `Bearer ${token}`
      }
    });
    return next(cloned);
  }
  return next(req);
};

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideHttpClient(withInterceptors([authInterceptor]))
  ]
};
