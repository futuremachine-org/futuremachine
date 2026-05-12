# Patches

This folder contains a patch to @changesets/assemble-release-plan, the package
that helps to determine how a package should be bumped.

The patch is a temporary workaround for
https://github.com/changesets/changesets/issues/1887 where when a package has a
minor bump, any package that has that package as a peerDependency gets a major
bump. We do not want to bump to 1.0.0 in any of our packages yet.

This patch should be removed once either:
* changesets changes this behavior.
* we release 1.0.0 for all our packages.
