jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn().mockRejectedValue({ code: 'ENOENT' }),
    writeFile: jest.fn().mockResolvedValue(undefined),
    mkdir: jest.fn().mockResolvedValue(undefined),
  },
}));

import { DamlService } from '../daml/daml-ledger.service';
import { PartiesService } from './parties.service';
import { PartyStatus } from './types/party.types';

describe('PartiesService', () => {
  it('skips Daml participant creation when participant sync is not configured', async () => {
    const createParticipant = jest.fn();
    const damlLedgerService = {
      hasParticipantSyncConfig: jest.fn().mockReturnValue(false),
      createParticipant,
      activateParticipant: jest.fn(),
      deactivateParticipant: jest.fn(),
      findParticipantContract: jest.fn(),
    } as unknown as DamlService;

    const service = new PartiesService(damlLedgerService);

    const result = await service.createParty({
      partyId: 'party1',
      organizationName: 'Acme Corp',
      partyType: 'organization' as any,
    });

    expect(createParticipant).not.toHaveBeenCalled();
    expect(result.status).toBe(PartyStatus.ACTIVE);
    expect(result.active).toBe(true);
  });

  it('deactivates a party and syncs to DAML when participant sync is configured', async () => {
    const damlLedgerService = {
      hasParticipantSyncConfig: jest.fn().mockReturnValue(true),
      createParticipant: jest.fn().mockResolvedValue({ contractId: 'create-1', payload: { active: true } }),
      activateParticipant: jest.fn(),
      deactivateParticipant: jest.fn().mockResolvedValue('deactivate-1'),
      findParticipantContract: jest.fn(),
    } as unknown as DamlService;

    const service = new PartiesService(damlLedgerService);

    const created = await service.createParty({
      partyId: 'party2',
      organizationName: 'Acme Corp',
      partyType: 'organization' as any,
    });

    const result = await service.deactivateParty(created.partyId);

    expect(damlLedgerService.deactivateParticipant).toHaveBeenCalledWith('party2');
    expect(result.status).toBe(PartyStatus.DEACTIVATED);
    expect(result.active).toBe(false);
    expect(result.damlContractId).toBe('deactivate-1');
  });

  it('refreshes party status from DAML contract when getting a party', async () => {
    const damlLedgerService = {
      hasParticipantSyncConfig: jest.fn().mockReturnValue(true),
      createParticipant: jest.fn().mockResolvedValue({ contractId: 'create-2', payload: { active: true } }),
      activateParticipant: jest.fn(),
      deactivateParticipant: jest.fn(),
      findParticipantContract: jest.fn().mockResolvedValue({ contractId: 'contract-2', payload: { active: false } }),
    } as unknown as DamlService;

    const service = new PartiesService(damlLedgerService);

    const created = await service.createParty({
      partyId: 'party3',
      organizationName: 'Acme Corp',
      partyType: 'organization' as any,
    });

    const result = await service.getParty(created.id);

    expect(damlLedgerService.findParticipantContract).toHaveBeenCalledWith('party3');
    expect(result.damlContractId).toBe('contract-2');
    expect(result.status).toBe(PartyStatus.DEACTIVATED);
    expect(result.active).toBe(false);
  });
});
