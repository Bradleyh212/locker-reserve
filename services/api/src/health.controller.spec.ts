import { HealthController } from './health.controller';
describe('dependency readiness', () => {
  it('requires both PostgreSQL and Redis', async () => {
    const db = { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) };
    const cache = { isHealthy: jest.fn().mockResolvedValue(true) };
    const controller = new HealthController(db as any, cache as any);
    await expect(controller.readiness()).resolves.toMatchObject({
      service: 'locker-reserve-api',
      status: 'ok',
    });
    cache.isHealthy.mockResolvedValue(false);
    await expect(controller.readiness()).rejects.toThrow(
      'Dependencies unavailable',
    );
    db.$queryRaw.mockRejectedValue(new Error('DB unavailable'));
    await expect(controller.readiness()).rejects.toThrow(
      'Dependencies unavailable',
    );
  });
});
