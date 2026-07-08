import { container } from "./container";
import { QUEUES } from "./rabbitmq";
import { RequirementHandler } from "./handlers/requirement-handler";
import { RecommendationHandler } from "./handlers/recommendation-handler";
import { CodegenHandler } from "./handlers/codegen-handler";
import { SchematicHandler } from "./handlers/schematic-handler";
import { WebsearchHandler } from "./handlers/websearch-handler";

container.register(QUEUES.REQUIREMENT_OUTPUT, new RequirementHandler());
container.register(QUEUES.RECOMMENDATION_OUTPUT, new RecommendationHandler());
container.register(QUEUES.CODEGEN_OUTPUT, new CodegenHandler());
container.register(QUEUES.SCHEMATIC_OUTPUT, new SchematicHandler());
container.register(QUEUES.WEBSERACH_OUTPUT, new WebsearchHandler());
