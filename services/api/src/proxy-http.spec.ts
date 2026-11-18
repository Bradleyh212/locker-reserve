import { Test } from '@nestjs/testing';
import { Controller, Post, Req, UseGuards } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import request from 'supertest';
import { configureProxy } from './proxy-config';
import { ReservationCredentialGuard } from './customer/reservation-credential.guard';
@Controller('proxy-fixture')
class Fixture {
  @Post()
  @UseGuards(ReservationCredentialGuard)
  read(@Req() req: RawBodyRequest<Request>) {
    return { secure: req.secure, raw: req.rawBody?.toString('utf8') };
  }
}
describe('TLS termination and unchanged signed bytes', () => {
  const old = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = old;
  });
  async function application(peer?: string) {
    const module = await Test.createTestingModule({
      controllers: [Fixture],
      providers: [ReservationCredentialGuard],
    }).compile();
    const app = module.createNestApplication({ rawBody: true });
    configureProxy(app.getHttpAdapter().getInstance(), {
      NODE_ENV: 'production',
      CORS_ORIGIN: 'https://fixture.example.test',
      ...(peer && { TRUSTED_PROXY_IP: peer }),
    });
    await app.init();
    process.env.NODE_ENV = 'production';
    return app;
  }
  it('rejects spoofed forwarded HTTPS from an untrusted peer', async () => {
    const app = await application('192.0.2.1');
    try {
      await request(app.getHttpServer())
        .post('/proxy-fixture')
        .set('X-Forwarded-Proto', 'https')
        .send({})
        .expect(403);
    } finally {
      await app.close();
    }
  });
  it('accepts the exact proxy peer and preserves whitespace for Stripe verification', async () => {
    const app = await application('127.0.0.1');
    const raw = '{\n  "fixture": true\n}';
    try {
      const response = await request(app.getHttpServer())
        .post('/proxy-fixture')
        .set('X-Forwarded-Proto', 'https')
        .set('Content-Type', 'application/json')
        .send(raw)
        .expect(201);
      expect(response.body).toEqual({ secure: true, raw });
      await request(app.getHttpServer())
        .post('/proxy-fixture')
        .send({})
        .expect(403);
    } finally {
      await app.close();
    }
  });
});
