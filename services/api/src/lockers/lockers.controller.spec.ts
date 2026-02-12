import { Test, TestingModule } from '@nestjs/testing';
import { LockersController } from './lockers.controller';

describe('LockersController', () => {
  let controller: LockersController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [LockersController],
    }).compile();

    controller = module.get<LockersController>(LockersController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
