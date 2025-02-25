import { Test, TestingModule } from '@nestjs/testing';
import { PlayService } from './streaming.service';

describe('PlayService', () => {
  let service: PlayService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PlayService],
    }).compile();

    service = module.get<PlayService>(PlayService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
