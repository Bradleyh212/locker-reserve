import { configureProxy } from './proxy-config';
describe('reverse proxy boundary', () => {
  it('defaults to no proxy trust for development', () => {
    const app = { set: jest.fn() };
    configureProxy(app, {});
    expect(app.set).toHaveBeenCalledWith('trust proxy', false);
  });
  it('trusts exactly the configured peer', () => {
    const app = { set: jest.fn() };
    configureProxy(app, {
      NODE_ENV: 'production',
      CORS_ORIGIN: 'https://staging.example.com',
      TRUSTED_PROXY_IP: '172.30.88.2',
    });
    expect(app.set).toHaveBeenCalledWith('trust proxy', ['172.30.88.2']);
  });
  it.each(['true', '1', '0.0.0.0/0', 'loopback', '172.30.88.2,1.2.3.4'])(
    'rejects broad trust %s',
    (peer) => {
      expect(() =>
        configureProxy({ set: jest.fn() }, { TRUSTED_PROXY_IP: peer }),
      ).toThrow();
    },
  );
  it.each([
    '*',
    'http://staging.example.com',
    'https://staging.example.com/path',
    'https://staging.example.com/',
  ])('rejects unsafe production origin %s', (origin) => {
    expect(() =>
      configureProxy(
        { set: jest.fn() },
        { NODE_ENV: 'production', CORS_ORIGIN: origin },
      ),
    ).toThrow();
  });
});
