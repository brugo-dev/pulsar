const Registry = require('winreg');
const Path = require('path');
const ChildProcess = require('child_process');
const getAppName = require('../get-app-name');

const appName = getAppName();
const exeName = Path.basename(process.execPath);
const appPath = `"${process.execPath}"`;
const fileIconPath = `"${Path.join(
  process.execPath,
  '..',
  'resources',
  'cli',
  'file.ico'
)}"`;

class ShellOption {
  constructor(key, parts) {
    this.isRegistered = this.isRegistered.bind(this);
    this.register = this.register.bind(this);
    this.deregister = this.deregister.bind(this);
    this.update = this.update.bind(this);
    this.key = key;
    this.parts = parts;
  }

  isRegistered(callback) {
    new Registry({
      hive: 'HKCU',
      key: `${this.key}\\${this.parts[0].key}`
    }).get(this.parts[0].name, (err, val) =>
      callback(err == null && val != null && val.value === this.parts[0].value)
    );
  }

  register(callback) {
    let doneCount = this.parts.length;
    this.parts.forEach(part => {
      let reg = new Registry({
        hive: 'HKCU',
        key: part.key != null ? `${this.key}\\${part.key}` : this.key
      });
      return reg.create(() =>
        reg.set(part.name, Registry.REG_SZ, part.value, () => {
          if (--doneCount === 0) return callback();
        })
      );
    });
  }

  deregister(callback) {
    this.isRegistered(isRegistered => {
      if (isRegistered) {
        new Registry({ hive: 'HKCU', key: this.key }).destroy(() =>
          callback(null, true)
        );
      } else {
        callback(null, false);
      }
    });
  }

  update(callback) {
    new Registry({
      hive: 'HKCU',
      key: `${this.key}\\${this.parts[0].key}`
    }).get(this.parts[0].name, (err, val) => {
      if (err != null || val == null) {
        callback(err);
      } else {
        this.register(callback);
      }
    });
  }
}

class PathOption {
  constructor() {
    this.HKCUPATH = "\\Environment";
    this.HKCUInstallReg = "\\SOFTWARE\\0949b555-c22c-56b7-873a-a960bdefa81f";
    this.HKLMPATH = "\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment";
    // Unfortunately, we can only manage the PATH for a per user installation.
    // While the PowerShell script does support setting the PATH for a Machine
    // install, we can't yet check that.
    // https://github.com/fresc81/node-winreg/tree/1.2.1#troubleshooting
    // This can only be done if Pulsar is run as Admin, with a user with Admin privs
    // So we will pretend a user install is all that matters here
    this.isRegistered = this.isRegistered.bind(this);
    this.register = this.register.bind(this);
  }

  isRegistered(callback) {
    let userInstallRegKey = new Registry({
      hive: 'HKCU',
      key: this.HKCUPATH
    });

    let isUserInstalled = false;

    userInstallRegKey.values((err, items) => {
      if (err) {
        callback(err);
      } else {
        for (let i = 0; i < items.length; i++) {
          if (items[i].name === "Path") {
            let winPath = items[i].value;
            if (winPath.includes("Pulsar\\resources") || winPath.includes("Pulsar\\resources\\app\\ppm\\bin")) {
              isUserInstalled = true;
            }
          }
        }
      }
    });
    return isUserInstalled;
  }

  register(callback) {
    let {err, pulsarPath} = this.getPulsarPath();
    if (err) {
      return callback(err)
    }

    const child = ChildProcess.execFile(
        `${pulsarPath}\\resources\\modifyWindowsPath.ps1`,
        ['-installMode', 'User', '-installdir', `"${pulsarPath}"`, '-remove', '0'],
        (error, stdout, stderr) =>
        {
      if (error) {
        callback(error);
      } else {
        return callback();
      }
    });
  }

  deregister(callback) {
    this.isRegistered(isRegistered => {
      if (isRegistered) {
        let {err, pulsarPath} = this.getPulsarPath();
        if (err) {
          return callback(err);
        }

        const child = ChildProcess.execFile(
            `${pulsarPath}\\resources\\modifyWindowsPath.ps1`,
            ['-installMode', 'User', '-installdir', `"${pulsarPath}"`, '-remove', '1'],
            (error, stdout, stderr) =>
            {
          if (error) {
            callback(error);
          } else {
            return callback();
          }
        });
      } else {
        callback(null, false);
      }
    });
  }

  getPulsarPath() {
    let pulsarPath;
    let pulsarPathReg = new Registry({
      hive: "HKCU",
      key: this.HKCUInstallReg
    }).get("InstallLocation", (err, val) => {
      if (err) {
        return {err, null};
      } else {
        pulsarPath = val.value;
      }
    });

    if (pulsarPath.length === 0) {
      return {"Unable to find Pulsar Install Path", null};
    }

    return {null, pulsarPath};
  }
}

exports.appName = appName;

exports.fileHandler = new ShellOption(
  `\\Software\\Classes\\Applications\\${exeName}`,
  [
    { key: 'shell\\open\\command', name: '', value: `${appPath} "%1"` },
    { key: 'shell\\open', name: 'FriendlyAppName', value: `${appName}` },
    { key: 'DefaultIcon', name: '', value: `${fileIconPath}` }
  ]
);

let contextParts = [
  { key: 'command', name: '', value: `${appPath} "%1"` },
  { name: '', value: `Open with ${appName}` },
  { name: 'Icon', value: `${appPath}` }
];

exports.fileContextMenu = new ShellOption(
  `\\Software\\Classes\\*\\shell\\${appName}`,
  contextParts
);
exports.folderContextMenu = new ShellOption(
  `\\Software\\Classes\\Directory\\shell\\${appName}`,
  contextParts
);
exports.folderBackgroundContextMenu = new ShellOption(
  `\\Software\\Classes\\Directory\\background\\shell\\${appName}`,
  JSON.parse(JSON.stringify(contextParts).replace('%1', '%V'))
);
exports.path = new PathOption();
