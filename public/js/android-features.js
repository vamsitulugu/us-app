/* ════════════════════════════════════════════════════════════════
   Twin Hearts — Android Native Features Bridge
   Wraps all Capacitor Android plugins into a clean, promise-based API.
   Include via: <script src="/js/android-features.js"></script>
 ═════════════════════════════════════════════════════════════════ */
'use strict';

(function (global) {
  const isAndroid = /android/i.test(navigator.userAgent);
  const isNative = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();

  function pluginExists(name) {
    return isNative && window.Capacitor.Plugins && window.Capacitor.Plugins[name];
  }

  function callPlugin(name, method, options = {}) {
    return new Promise((resolve, reject) => {
      if (!pluginExists(name)) {
        reject(new Error(name + ' plugin not available on this platform'));
        return;
      }
      try {
        window.Capacitor.Plugins[name][method](options).then((result) => {
          resolve(result);
        }).catch((err) => {
          reject(err);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  const AndroidFeatures = {
    isAndroid: function () { return isAndroid && isNative; },
    isNative: function () { return isNative; },

    isBiometricAvailable: function () {
      return callPlugin('BiometricAuth', 'isAvailable').then(function (r) { return r.available === true; });
    },

    authenticateBiometric: function (options) {
      options = options || {};
      return callPlugin('BiometricAuth', 'authenticate', {
        title: options.title || 'Unlock Twin Hearts',
        subtitle: options.subtitle || 'Use your fingerprint or face',
        description: options.description || 'Biometric authentication required',
        negativeButtonText: options.negativeButtonText || 'Cancel'
      }).then(function (r) { return r.success === true; });
    },

    getDeviceInfo: function () {
      return callPlugin('DeviceInfo', 'getInfo');
    },

    isAppInstalled: function (packageName) {
      return callPlugin('DeviceInfo', 'isAppInstalled', { packageName: packageName }).then(function (r) { return r.installed === true; });
    },

    launchApp: function (packageName) {
      return callPlugin('DeviceInfo', 'launchApp', { packageName: packageName });
    },

    getNetworkStatus: function () {
      return callPlugin('NetworkInfo', 'getStatus');
    },

    clipboardWrite: function (text) {
      return callPlugin('Clipboard', 'write', { text: text }).then(function (r) { return r.success === true; });
    },

    clipboardRead: function () {
      return callPlugin('Clipboard', 'read').then(function (r) {
        return { text: r.text || '', hasText: r.hasText === true };
      });
    },

    scheduleLocalNotification: function (options) {
      options = options || {};
      return callPlugin('LocalNotifications', 'schedule', {
        title: options.title || 'Twin Hearts',
        body: options.body || '',
        id: options.id || 10000,
        scheduleAt: options.scheduleAt || Date.now(),
        channelId: options.channelId || 'twin_hearts_local'
      });
    },

    cancelLocalNotification: function (id) {
      return callPlugin('LocalNotifications', 'cancel', { id: id });
    },

    cancelAllLocalNotifications: function () {
      return callPlugin('LocalNotifications', 'cancelAll');
    },

    isPiPAvailable: function () {
      return callPlugin('PictureInPicture', 'isAvailable').then(function (r) { return r.available === true; });
    },

    enterPiP: function () {
      return callPlugin('PictureInPicture', 'enter');
    },

    showToast: function (options) {
      options = options || {};
      return callPlugin('NativeToast', 'show', {
        text: options.text || 'Twin Hearts',
        duration: options.duration || 2000
      }).then(function (r) { return r.shown === true; });
    },

    setKeyboardMode: function (mode) {
      mode = mode || 'resize';
      return callPlugin('Keyboard', 'setResizeMode', { mode: mode });
    },

    hideKeyboard: function () {
      return callPlugin('Keyboard', 'hide');
    },

    showKeyboard: function () {
      return callPlugin('Keyboard', 'show');
    },

    isKeyboardVisible: function () {
      return callPlugin('Keyboard', 'isVisible').then(function (r) { return r.visible === true; });
    },

    toast: function (message, duration) {
      return AndroidFeatures.showToast({ text: message, duration: duration || 2000 });
    },

    handleSharedMedia: null
  };

  global.AndroidFeatures = AndroidFeatures;

  if (isNative && isAndroid) {
    document.addEventListener('DOMContentLoaded', function () {
      AndroidFeatures.setKeyboardMode('resize').catch(function () {});
    });
  }
})(window);
