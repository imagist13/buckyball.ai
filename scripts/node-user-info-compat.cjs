/* eslint-disable @typescript-eslint/no-require-imports */
// tsx derives its temporary directory name from os.userInfo(). On Windows,
// libuv can transiently return ENOMEM for that lookup after a large node:test
// run, even though USERPROFILE/USERNAME remain available. Keep test and dev
// tooling usable by falling back to the process environment in that case.
if (process.platform === 'win32') {
  const os = require('node:os');
  const originalUserInfo = os.userInfo.bind(os);

  os.userInfo = (...args) => {
    try {
      return originalUserInfo(...args);
    } catch (error) {
      if (error?.code !== 'ERR_SYSTEM_ERROR' || error?.info?.code !== 'ENOMEM') {
        throw error;
      }

      const username = process.env.USERNAME || 'windows-user';
      const homedir = process.env.USERPROFILE || os.homedir();
      return { username, uid: -1, gid: -1, shell: null, homedir };
    }
  };
}
