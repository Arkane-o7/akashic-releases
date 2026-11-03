// Generic bounded-memory inventory used only by disposable performance experiments.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const fail=message=>{throw new Error(message)};
function inventory(root, prefix = '') {
  const result = {};
  const buffer = Buffer.allocUnsafe(256 * 1024);
  function digest(file) {
    const fd = fs.openSync(file, 'r');
    try {
      const sha = crypto.createHash('sha256');
      let bytes;
      while ((bytes = fs.readSync(fd, buffer, 0, buffer.length, null)) !== 0) {
        sha.update(buffer.subarray(0, bytes));
      }
      return sha.digest('hex');
    } finally { fs.closeSync(fd); }
  }
  function visit(directory) {
    for (const name of fs.readdirSync(path.join(root, directory)).sort()) {
      const relative = directory ? `${directory}/${name}` : name;
      if (relative === 'manifest.json') continue;
      const file = path.join(root, relative);
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) {
        const target = fs.readlinkSync(file);
        const resolved = fs.realpathSync(file);
        if (path.isAbsolute(target) || !resolved.startsWith(fs.realpathSync(root) + path.sep)) fail(`escaping symlink: ${relative}`);
        result[relative] = { link: target };
      } else if (stat.isDirectory()) visit(relative);
      else if (stat.isFile()) result[relative] = { sha256: digest(file), executable: Boolean(stat.mode & 0o111) };
      else fail(`unsupported entry: ${relative}`);
    }
  }
  visit(prefix);
  return result;
}

module.exports={inventory};
