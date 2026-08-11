import { RelationshipsController } from './relationships.controller';
import { RelationshipsService } from './relationships.service';

describe('RelationshipsController', () => {
  let controller: RelationshipsController;
  let service: Pick<RelationshipsService, 'createRelationship' | 'getAllRelationships'>;

  beforeEach(() => {
    service = {
      createRelationship: jest.fn().mockResolvedValue({ id: 'r-1' }),
      getAllRelationships: jest.fn().mockResolvedValue([{ id: 'r-1' }]),
    } as any;

    controller = new RelationshipsController(service as RelationshipsService);
  });

  it('creates a relationship', async () => {
    const result = await controller.createRelationship({ fromPartyId: 'p1', toPartyId: 'p2', relationshipType: 'HOLDER' } as any);
    expect(service.createRelationship).toHaveBeenCalled();
    expect(result).toEqual({ id: 'r-1' });
  });

  it('lists relationships', async () => {
    const result = await controller.getAllRelationships();
    expect(service.getAllRelationships).toHaveBeenCalled();
    expect(result).toEqual([{ id: 'r-1' }]);
  });
});
