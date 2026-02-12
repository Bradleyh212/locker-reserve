import { Test, TestingModule } from '@nestjs/testing';
import { LockersService } from './lockers.service';

describe('LockersService', () => {
  let service: LockersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [LockersService],
    }).compile();

    service = module.get<LockersService>(LockersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
