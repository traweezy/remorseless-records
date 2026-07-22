const buildForwardedArgs = (rawArgs) => {
  const scriptArgs = rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs;
  return scriptArgs.length > 0 ? ['--', ...scriptArgs] : [];
};

module.exports = { buildForwardedArgs };
