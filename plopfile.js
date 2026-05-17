import fs from 'fs';

function rewriteJson(path, rewrite) {
  const json = JSON.parse(fs.readFileSync(path, 'utf8'));
  rewrite(json);
  fs.writeFileSync(path, JSON.stringify(json, null, 2));
}

export default function (plop) {
  // Add helper to get the current year for the copyright.
  plop.setHelper('year', () => new Date().getFullYear());

  plop.setGenerator('package', {
    description: 'Scaffold a new package',
    prompts: [
      {
        type: 'input',
        name: 'name',
        message: 'Package name:',
      },
      {
        type: 'input',
        name: 'description',
        message: 'Package description:',
      },
      {
        type: 'confirm',
        name: 'isPublic',
        message: 'Is this a public package?',
        default: false,
      },
    ],
    actions: [
      {
        type: 'addMany',
        destination: 'packages/{{name}}',
        templateFiles: 'templates/package/**/*',
        base: 'templates/package',
      },
      function updateRootConfigs(answers) {
        // Add package to the root tsconfig.json.
        rewriteJson('./tsconfig.json', (tsconfig) => {
          tsconfig.references.push({ path: `./packages/${answers.name}` });
        });

        // Add test command to package.json's scripts.
        rewriteJson('./package.json', (rootPkg) => {
          rootPkg.scripts[`test:${answers.name}`] =
            `npm run build && npm run --prefix packages/${answers.name} test --`;
        });

        return 'Root files updated';
      },
    ],
  });
}
