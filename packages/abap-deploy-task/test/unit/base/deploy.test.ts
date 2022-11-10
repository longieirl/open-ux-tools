import prompts from 'prompts';
import { deploy, getCredentials, undeploy } from '../../../src/base/deploy';
import type { BackendSystemKey } from '@sap-ux/store';
import { NullTransport, ToolsLogger } from '@sap-ux/logger';
import type { AbapDeployConfig } from '../../../src/types';
import { mockedStoreService, mockIsAppStudio, mockedUi5RepoService } from '../../__mocks__';
import { join } from 'path';

describe('base/deploy', () => {
    const nullLogger = new ToolsLogger({ transports: [new NullTransport()] });
    const app: AbapDeployConfig['app'] = {
        name: '~name',
        desription: '~description',
        package: '~package',
        transport: '~transport'
    };
    const target = {
        url: 'http://target.example',
        client: '001'
    };

    describe('getCredentials', () => {
        test('AppStudio - no place to get credentials', async () => {
            mockIsAppStudio.mockReturnValueOnce(true);
            const credentials = await getCredentials(target);
            expect(credentials).toBeUndefined();
        });

        test('read credentials from store', async () => {
            mockIsAppStudio.mockReturnValue(false);
            const credentials = await getCredentials({ url: target.url });
            expect(credentials).toBeDefined();
        });

        test('fallback read without client parameter', async () => {
            mockIsAppStudio.mockReturnValue(false);
            mockedStoreService.read.mockImplementation((key: BackendSystemKey) =>
                key.getId().includes(target.client) ? undefined : {}
            );
            const credentials = await getCredentials(target);
            expect(credentials).toBeDefined();
        });
    });

    describe('deploy', () => {
        const archive = Buffer.from('TestData');
        const axiosError = (status: 401 | 412) => {
            return {
                isAxiosError: true,
                response: { status }
            };
        };

        beforeEach(() => {
            mockedUi5RepoService.deploy.mockReset();
        });

        test('No errors locally with url', async () => {
            const credentials = { username: '~username', password: '~password' };
            mockedStoreService.read.mockResolvedValueOnce(credentials);
            mockedUi5RepoService.deploy.mockResolvedValue(undefined);
            await deploy(archive, { app, target }, nullLogger);
            expect(mockedUi5RepoService.deploy).toBeCalledWith(archive, app, undefined, undefined);
            await deploy(archive, { app, target, test: true, safe: false, credentials }, nullLogger);
            expect(mockedUi5RepoService.deploy).toBeCalledWith(archive, app, true, false);
        });

        test('No errors in AppStudio with destinations', async () => {
            mockIsAppStudio.mockReturnValueOnce(true);
            mockedUi5RepoService.deploy.mockResolvedValue(undefined);
            await deploy(archive, { app, target: { destination: '~destination' } }, nullLogger);
            expect(mockedUi5RepoService.deploy).toBeCalledWith(archive, app, undefined, undefined);
        });

        test('No errors locally with ABAP on BTP', async () => {
            const credentials = {
                serviceKeys: {
                    uaa: {
                        clientid: '~client',
                        clientsecret: '~clientsecret',
                        url: target.url
                    }
                },
                url: target.url
            };
            mockedStoreService.read.mockResolvedValueOnce(credentials);
            mockedUi5RepoService.deploy.mockResolvedValue(undefined);
            await deploy(archive, { app, target: { ...target, scp: true } }, nullLogger);
            expect(mockedUi5RepoService.deploy).toBeCalledWith(archive, app, undefined, undefined);
        });

        test('Handle missing service keys with ABAP on BTP', async () => {
            mockedStoreService.read.mockResolvedValue(undefined);
            mockedUi5RepoService.deploy.mockResolvedValue(undefined);
            prompts.inject([join(__dirname, '../../test-input/service-keys.json')]);
            await deploy(archive, { app, target: { ...target, scp: true } }, nullLogger);
            expect(mockedUi5RepoService.deploy).toBeCalledWith(archive, app, undefined, undefined);
        });

        test('Successful retry after known axios error', async () => {
            mockedUi5RepoService.deploy.mockResolvedValue(undefined);
            mockedUi5RepoService.deploy.mockRejectedValueOnce(axiosError(412));
            await deploy(archive, { app, target, yes: true }, nullLogger);
            mockedUi5RepoService.deploy.mockRejectedValueOnce(axiosError(401));
            prompts.inject(['~username', '~password']);
            await deploy(archive, { app, target, yes: true }, nullLogger);
        });

        test('Axios Error and no retry', async () => {
            const sameIdError = axiosError(412);
            mockedUi5RepoService.deploy.mockRejectedValueOnce(sameIdError);
            try {
                await deploy(archive, { app, target, noRetry: true }, nullLogger);
                fail('Should have thrown an error');
            } catch (error) {
                expect(error).toBe(sameIdError);
            }
        });

        test('Throw error after retries', async () => {
            const sameIdError = axiosError(412);
            mockedUi5RepoService.deploy.mockRejectedValue(sameIdError);
            try {
                await deploy(archive, { app, target, yes: true }, nullLogger);
                fail('Should have thrown an error');
            } catch (error) {
                expect(error).toBe(sameIdError);
            }
        });

        test('Throw unknown error', async () => {
            const unknownError = new Error();
            mockedUi5RepoService.deploy.mockRejectedValue(unknownError);
            try {
                await deploy(archive, { app, target }, nullLogger);
                fail('Should have thrown an error');
            } catch (error) {
                expect(error).toBe(unknownError);
            }
        });
    });

    describe('undeploy', () => {
        test('No errors', async () => {
            mockedUi5RepoService.undeploy.mockResolvedValue({});
            await undeploy({ app, target }, nullLogger);
            expect(mockedUi5RepoService.undeploy).toBeCalledWith(app, undefined);
            await undeploy({ app, target, test: true }, nullLogger);
            expect(mockedUi5RepoService.undeploy).toBeCalledWith(app, true);
        });
    });
});