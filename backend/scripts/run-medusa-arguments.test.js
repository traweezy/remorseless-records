const { buildForwardedArgs } = require('./run-medusa-arguments');

describe('Medusa script argument forwarding', () => {
  it('does not add a separator when no script arguments are present', () => {
    expect(buildForwardedArgs([])).toEqual([]);
  });

  it('adds the Medusa separator before direct script arguments', () => {
    expect(buildForwardedArgs(['--apply'])).toEqual(['--', '--apply']);
  });

  it('preserves one separator when pnpm forwards one explicitly', () => {
    expect(buildForwardedArgs(['--', '--apply'])).toEqual(['--', '--apply']);
  });
});
