import {
  Module,
  Global,
  type NestModule,
  type OnModuleInit,
  type MiddlewareConsumer,
  Logger,
  type Provider,
} from "@nestjs/common";
import { ConfigurableModuleBuilder } from "@nestjs/common";
import { Arkveil, type ArkveilParams } from "arkveil";

export interface ArkveilModuleOptions extends ArkveilParams {}

const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN } =
  new ConfigurableModuleBuilder<ArkveilModuleOptions>({
    moduleName: "Arkveil",
  })
    .setClassMethodName("forRoot")
    .setFactoryMethodName("create")
    .build();

const ArkveilProvider: Provider = {
  provide: Arkveil,
  useFactory: (options: ArkveilModuleOptions) => {
    return new Arkveil(options);
  },
  inject: [MODULE_OPTIONS_TOKEN],
};

@Global()
@Module({
  providers: [ArkveilProvider],
  exports: [Arkveil],
})
export class ArkveilModule
  extends ConfigurableModuleClass
  implements NestModule, OnModuleInit
{
  private readonly logger = new Logger(ArkveilModule.name);

  onModuleInit() {
    this.logger.log("Arkveil module initialized");
  }

  configure(consumer: MiddlewareConsumer) {}
}
