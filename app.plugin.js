const fs = require('fs');
const path = require('path');
const { withDangerousMod, withMainApplication } = require('expo/config-plugins');

// Custom Android native module (AudioOutput: force speaker / earpiece routing).
// Sources live outside android/ so they survive `expo prebuild --clean`.
const AUDIO_OUTPUT_SRC_DIR = path.join(__dirname, 'plugins', 'audio-output', 'android');
const AUDIO_OUTPUT_FILES = ['AudioOutputModule.kt', 'AudioOutputPackage.kt'];

const withAudioOutputSources = (config) =>
  withDangerousMod(config, [
    'android',
    async (cfg) => {
      const pkg = cfg.android.package;
      const destDir = path.join(
        cfg.modRequest.platformProjectRoot,
        'app', 'src', 'main', 'java',
        ...pkg.split('.')
      );
      fs.mkdirSync(destDir, { recursive: true });
      for (const file of AUDIO_OUTPUT_FILES) {
        fs.copyFileSync(path.join(AUDIO_OUTPUT_SRC_DIR, file), path.join(destDir, file));
      }
      return cfg;
    },
  ]);

const withAudioOutputPackage = (config) =>
  withMainApplication(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (src.includes('AudioOutputPackage()')) return cfg;
    if (/PackageList\(this\)\.packages\.apply\s*\{/.test(src)) {
      // RN >= 0.80 template
      src = src.replace(
        /(PackageList\(this\)\.packages\.apply\s*\{)/,
        '$1\n              add(AudioOutputPackage())'
      );
    } else if (/val packages = PackageList\(this\)\.packages/.test(src)) {
      // older template
      src = src.replace(
        /(val packages = PackageList\(this\)\.packages)/,
        '$1\n            packages.add(AudioOutputPackage())'
      );
    } else {
      throw new Error('[app.plugin] Could not register AudioOutputPackage in MainApplication');
    }
    cfg.modResults.contents = src;
    return cfg;
  });

module.exports = (config) => {
  if (!config.android) {
    config.android = {};
  }

  if (!config.android.intentFilters) {
    config.android.intentFilters = [];
  }

  // Add an intent filter to handle Google auth redirect
  config.android.intentFilters.push({
    action: "VIEW",
    autoVerify: true,
    data: [
      {
        scheme: "com.naqued.speechlinkmobile",
      },
    ],
    category: ["BROWSABLE", "DEFAULT"],
  });

  config = withAudioOutputSources(config);
  config = withAudioOutputPackage(config);
  return config;
};
