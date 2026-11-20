import { NextFunction, Response } from 'express';
import { AuthenticatedRequest } from '../../types/api.types';
import { ResponseUtil } from '../../utils/response.utils';
import { requireOwnerOrAdmin } from '../rbac.middleware';

describe('requireOwnerOrAdmin', () => {
  const userId = 'user-123';
  let res: Response;
  let next: jest.MockedFunction<NextFunction>;

  beforeEach(() => {
    res = {} as Response;
    next = jest.fn();
    jest.spyOn(ResponseUtil, 'forbidden').mockImplementation(() => res);
    jest.spyOn(ResponseUtil, 'unauthorized').mockImplementation(() => res);
  });

  it('uses the configured owner ID instead of treating a resource ID as the owner', () => {
    const middleware = requireOwnerOrAdmin((req) =>
      typeof req.params.ownerId === 'string' ? req.params.ownerId : undefined,
    );
    const req = {
      user: { id: userId, role: 'user' },
      params: { id: userId, ownerId: 'another-user' },
    } as unknown as AuthenticatedRequest;

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(ResponseUtil.forbidden).toHaveBeenCalledWith(res, 'Access denied');
  });

  it('allows the configured owner', () => {
    const middleware = requireOwnerOrAdmin((req) =>
      typeof req.params.ownerId === 'string' ? req.params.ownerId : undefined,
    );
    const req = {
      user: { id: userId, role: 'user' },
      params: { ownerId: userId },
    } as unknown as AuthenticatedRequest;

    middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('allows admins without resolving an owner ID', () => {
    const getOwnerId = jest.fn(() => undefined);
    const middleware = requireOwnerOrAdmin(getOwnerId);
    const req = {
      user: { id: userId, role: 'admin' },
      params: { id: 'resource-123' },
    } as unknown as AuthenticatedRequest;

    middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(getOwnerId).not.toHaveBeenCalled();
  });
});
