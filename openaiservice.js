// openaiservice.js
import { AIMessage, BaseMessage, HumanMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { ChatOpenAI } from "@langchain/openai";
import { StateGraph } from "@langchain/langgraph";
import { MemorySaver, Annotation } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";

// Define the graph state
const StateAnnotation = Annotation.Root({
  messages: Annotation({
    reducer: (x, y) => x.concat(y),
  }),
});

// Define the tools for the agent to use
const weatherTool = tool(async ({ query }) => {
  if (query.toLowerCase().includes("sf") || query.toLowerCase().includes("san francisco")) {
    return "It's 60 degrees and foggy.";
  }
  return "It's 90 degrees and sunny.";
}, {
  name: "weather",
  description: "Call to get the current weather for a location.",
  schema: z.object({
    query: z.string().describe("The query to use in your search."),
  }),
});

const tools = [weatherTool];
const toolNode = new ToolNode(tools);

// Initialize the OpenAI model
const model = new ChatOpenAI({
  openAIApiKey: process.env.OPENAI_API_KEY,
  modelName: 'gpt-4o-mini',
  temperature: 0,
}).bindTools(tools);

// Function to determine whether to continue or not
function shouldContinue(state) {
  const messages = state.messages;
  const lastMessage = messages[messages.length - 1];

  if (lastMessage.tool_calls?.length) {
    return "tools";
  }
  return "__end__";
}

// Function that calls the model
async function callModel(state) {
  const messages = state.messages;
  const response = await model.invoke(messages);
  return { messages: [response] };
}

// Define a new graph
const workflow = new StateGraph(StateAnnotation)
  .addNode("agent", callModel)
  .addNode("tools", toolNode)
  .addEdge("__start__", "agent")
  .addConditionalEdges("agent", shouldContinue)
  .addEdge("tools", "agent");

// Initialize memory to persist state between graph runs
const checkpointer = new MemorySaver();

// Compile the workflow into a LangChain Runnable
const app = workflow.compile({ checkpointer });

// Use the Runnable
const openAiService = async (message) => {
  const finalState = await app.invoke(
    { messages: [new HumanMessage(message)] },
    { configurable: { thread_id: "42" } }
  );
  return finalState.messages[finalState.messages.length - 1].content;
};

export default openAiService; // Ensure this is a default export
