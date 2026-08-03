// api/test/__mocks__/openid-client-strategy.js
const Strategy = jest.fn().mockImplementation((options, verify) => {
  return { name: 'mocked-openid-strategy', options, verify };
});

module.exports = { Strategy };
