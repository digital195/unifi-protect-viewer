/**
 * @file viewport-settings.js
 * @description Pure form↔config mapping for the Viewport card on config.html's
 * Startup tab. NO DOM access here — config.html wires these to its elements.
 * Unit-tested in test/js/viewport-settings.test.js (vm sandbox).
 *
 * Usage:
 *   <script src="viewport-settings.js"></script>
 *   window.viewportSettings.viewportFormFromConfig(redacted) → form state
 *   window.viewportSettings.validateViewportForm(form, redacted) → {ok,...}
 *   window.viewportSettings.buildViewportSetPayload(form) → viewportConfigSet payload
 */

(function () {
  'use strict';

  /** Maps the redacted config (viewportConfigGet) to display/form state. */
  function viewportFormFromConfig(redacted) {
    const r = redacted || {};
    return {
      enabled: !!r.enabled,
      name: r.name || '',
      url: r.url || '',
      username: r.username || '',
      fallbackProfileId: r.fallbackProfileId || '',
      namePlaceholder: r.defaultName || '',
      passwordPlaceholder: r.hasPassword ? 'unchanged' : '',
      showEncWarning: r.encryptionAvailable === false,
    };
  }

  /**
   * Validates the form before save. Returns { ok:true } or
   * { ok:false, error, field } where field is the input element id.
   * Credentials are REQUIRED in Viewport mode: they drive both the one-time
   * adopt and the silent render auto-login on every launch.
   */
  function validateViewportForm(form, redacted) {
    if (!form.enabled) return { ok: true };
    const url = (form.url || '').trim();
    if (!url) {
      return { ok: false, error: 'NVR URL is required for Viewport mode.', field: 'viewport-url' };
    }
    if (!/^https?:\/\//.test(url)) {
      return {
        ok: false,
        error: 'NVR URL must start with https:// or http://',
        field: 'viewport-url',
      };
    }
    if (!(form.username || '').trim()) {
      return {
        ok: false,
        error: 'Username is required for Viewport mode.',
        field: 'viewport-username',
      };
    }
    const hasStored = !!(redacted && redacted.hasPassword);
    const passwordOk = form.passwordChanged ? !!form.passwordValue : hasStored;
    if (!passwordOk) {
      return {
        ok: false,
        error: 'Password is required for Viewport mode.',
        field: 'viewport-password',
      };
    }
    return { ok: true };
  }

  /** Builds the viewportConfigSet payload from form state. */
  function buildViewportSetPayload(form) {
    return {
      enabled: !!form.enabled,
      name: (form.name || '').trim(),
      url: (form.url || '').trim(),
      username: (form.username || '').trim(),
      password: form.passwordChanged ? form.passwordValue : '',
      passwordChanged: !!form.passwordChanged,
      fallbackProfileId: form.fallbackProfileId || null,
    };
  }

  /**
   * Maps a Viewport-registration failure code (passed to config.html on the
   * `vp-error` query param when startViewportBridge hits a FATAL adoption error
   * with no usable fallback) to a human banner. Returns null for an
   * absent/unknown code so the caller shows nothing.
   *   'auth'   → the console rejected the admin username/password (401/403)
   *   'failed' → any other fatal registration failure
   */
  function adoptionErrorBanner(code) {
    if (code === 'auth') {
      return {
        title: 'Viewport registration failed',
        detail:
          'The console rejected the admin username or password for this Viewport. ' +
          'Re-enter them below, then Save & Restart.',
      };
    }
    if (code === 'failed') {
      return {
        title: 'Viewport registration failed',
        detail:
          'This window could not register as a Viewport. Check the NVR address and ' +
          'admin credentials below, then Save & Restart.',
      };
    }
    return null;
  }

  window.viewportSettings = {
    viewportFormFromConfig,
    validateViewportForm,
    buildViewportSetPayload,
    adoptionErrorBanner,
  };
})();
