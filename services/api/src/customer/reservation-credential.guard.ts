import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request, Response } from 'express';
@Injectable()
export class ReservationCredentialGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const http = context.switchToHttp();
    http.getResponse<Response>().setHeader('Cache-Control', 'no-store');
    http.getResponse<Response>().setHeader('Referrer-Policy', 'no-referrer');
    const req = http.getRequest<Request>();
    const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(
      req.socket.remoteAddress ?? '',
    );
    if (!req.secure && (process.env.NODE_ENV === 'production' || !local))
      throw new ForbiddenException(
        'HTTPS is required for reservation credentials',
      );
    return true;
  }
}
