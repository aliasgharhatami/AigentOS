const { execFile } = require("child_process");

/**
 * dependencyChecker
 * -----------------
 * Before installing an agent, verify the machine actually has what it needs.
 *
 * This exists because the failure it prevents is exactly the one that stops
 * ordinary users: an agent installs "successfully", then dies at launch with
 * `'python' is not recognized as an internal or external command`. That message
 * ends the experience for a non-technical person. Checking up front lets us say
 * "This agent needs Python, which isn't installed yet" and offer a download
 * link instead.
 */

const KNOWN = {
  node: {
    label: "Node.js",
    probe: ["node", ["--version"]],
    downloadUrl: "https://nodejs.org/en/download",
    why: "Many agents are distributed as Node packages.",
  },
  python3: {
    label: "Python 3",
    probe: [process.platform === "win32" ? "python" : "python3", ["--version"]],
    downloadUrl: "https://www.python.org/downloads/",
    why: "Many agents are written in Python.",
  },
  docker: {
    label: "Docker",
    probe: ["docker", ["--version"]],
    downloadUrl: "https://www.docker.com/products/docker-desktop/",
    why: "Some agents run inside a container for isolation.",
  },
  git: {
    label: "Git",
    probe: ["git", ["--version"]],
    downloadUrl: "https://git-scm.com/downloads",
    why: "Needed to download agents published on GitHub.",
  },
};

function probe(command, args) {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: 5000, windowsHide: true }, (err, stdout) => {
      if (err) return resolve({ present: false });
      resolve({ present: true, version: String(stdout).trim() });
    });
  });
}

/**
 * Check a list of requirement names from a manifest's runtime.requires.
 * Unknown names are reported rather than silently ignored — a typo in a
 * manifest should be visible, not invisible.
 */
async function checkRequirements(requires = []) {
  const results = [];

  for (const name of requires) {
    const known = KNOWN[name];
    if (!known) {
      results.push({
        name,
        label: name,
        present: false,
        unknown: true,
        message: `This agent requires "${name}", which AigentOS doesn't know how to check for.`,
      });
      continue;
    }

    const { present, version } = await probe(...known.probe);
    results.push({
      name,
      label: known.label,
      present,
      version,
      downloadUrl: known.downloadUrl,
      message: present
        ? `${known.label} is installed (${version}).`
        : `${known.label} is not installed. ${known.why}`,
    });
  }

  return {
    satisfied: results.every((r) => r.present),
    missing: results.filter((r) => !r.present),
    results,
  };
}

module.exports = { checkRequirements, KNOWN };
