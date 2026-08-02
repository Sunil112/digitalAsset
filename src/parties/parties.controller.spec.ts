import { PartiesController } from './parties.controller';
import { PartiesService } from './parties.service';

describe('PartiesController', () => {
  let controller: PartiesController;
  let partiesService: Pick<PartiesService, 'activateParty' | 'deactivateParty' | 'getParty'>;

  beforeEach(() => {
    partiesService = {
      activateParty: jest.fn().mockResolvedValue({ id: 'party-1' }),
      deactivateParty: jest.fn().mockResolvedValue({ id: 'party-1', status: 'DEACTIVATED' }),
      getParty: jest.fn().mockResolvedValue({ id: 'party-1' }),
    };

    controller = new PartiesController(partiesService as PartiesService);
  });

  it('activates a party using the action DTO payload', async () => {
    const result = await controller.activateParty({ partyId: 'party-1' });

    expect(partiesService.activateParty).toHaveBeenCalledWith('party-1');
    expect(result).toEqual({ id: 'party-1' });
  });

  it('deactivates a party using the action DTO payload', async () => {
    const result = await controller.deactivateParty({ partyId: 'party-1' });

    expect(partiesService.deactivateParty).toHaveBeenCalledWith('party-1');
    expect(result).toEqual({ id: 'party-1', status: 'DEACTIVATED' });
  });

  it('gets a single party by identifier', async () => {
    const result = await controller.getParty('party-1');

    expect(partiesService.getParty).toHaveBeenCalledWith('party-1');
    expect(result).toEqual({ id: 'party-1' });
  });
});
