// ES Modules imports
import mysql from 'mysql2/promise';
import sentry from '@sentry/serverless';
import { ProfilingIntegration } from '@sentry/profiling-node';
import { config } from 'dotenv';
config();
// Sentry setup
sentry.AWSLambda.init({
  dsn: process.env.SENTRY_DSN,
  integrations: [new ProfilingIntegration()],
  tracesSampleRate: 1.0,
  profilesSampleRate: 1.0,
});

// Function to connect to RDS
// async function connectToRDS(callerId) {
//   const config = {
//     host: process.env.DB_HOST,
//     user: process.env.DB_USER,
//     password: process.env.DB_PASSWORD,
//     database: process.env.DB_DATABASE,
//   };
//   const connection = await mysql.createConnection(config);
//   return connection;
// }

// Function to connect to RDS
async function connectToFriendlyDB(friendlyName) {
  // Replace hyphens with underscores in the friendlyName
  const sanitizedFriendlyName = friendlyName.replace(/-/g, '_');
  
  const config = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: sanitizedFriendlyName,
  };
  
  console.log("Connecting to DB with config");
  // console.log({config});
  return await mysql.createConnection(config);
}

async function connectToRDS() {
  const config = {
    host: process.env.DB_RDS_HOST,
    user: process.env.DB_RDS_USER,
    password: process.env.DB_RDS_PASSWORD,
    database: process.env.DB_RDS_DATABASE,
  };
  return await mysql.createConnection(config);
}

// Function to execute query
async function executeQuery(connection, phone) {
  // Remove the + sign if it exists in the phone number
  const sanitizedPhone = phone.replace(/\+/g, '\\+');
  // SQL query to find leads based on phone or mobile number
  const query = `
      SELECT
          l.id, l.company_phone, l.mobile, l.phone, l.firstname, l.lastname, l.company,
          CASE
              WHEN l.phone LIKE ? OR l.mobile LIKE ? THEN 'personal'
              WHEN l.company_phone LIKE ? THEN 'company'
              END as phone_type
      FROM
          leads AS l
      WHERE
          l.phone LIKE ?
         OR l.mobile LIKE ?
         OR l.company_phone LIKE ?
  `;
  
  // Parameters for the query, using the sanitized phone number
  const queryParams = [`%${sanitizedPhone}%`, `%${sanitizedPhone}%`, `%${sanitizedPhone}%`, `%${sanitizedPhone}%`, `%${sanitizedPhone}%`, `%${sanitizedPhone}%`];
  
  // Execute the query
  console.log("Executing query");
  // console.log("the query -> ", query);
  // console.log("the params -> ", queryParams);
  
  const [rows] = await connection.execute(query, queryParams);
  console.log("Query executed");
  // console.log(rows.length);
  
  // Check if any rows are returned from the query
  if (rows.length === 0) {
    // No matches found
    return { id: null, isMultiple: false };
  } else {
    // Matches found
    const firstRow = rows[0];
    const isMultiple = rows.length > 1;
    
    if (firstRow.phone_type === 'personal') {
      // If phone is found in mobile or phone, return single row
      return { id: firstRow.id, isMultiple: isMultiple };
    } else {
      // If phone is found in company_phone, return company
      return { id: firstRow.id, isMultiple: isMultiple, company: firstRow.company };
    }
  }
}


/**
 *
 * Event doc: https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html#api-gateway-simple-proxy-for-lambda-input-format
 * @param {Object} event - API Gateway Lambda Proxy Input Format
 *
 * Context doc: https://docs.aws.amazon.com/lambda/latest/dg/nodejs-prog-model-context.html
 * @param {Object} context
 *
 * Return doc: https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html
 * @returns {Object} object - API Gateway Lambda Proxy Output Format
 *
 */
export const lambdaHandler = sentry.AWSLambda.wrapHandler(async (event) => {
  try {
    console.log("Change deployed with SAM Accelerate")
    let params = event.queryStringParameters;
    if (!params) {
      return {
        statusCode: 400,
        headers: { "Content-Type": 'application/json' },
        body: JSON.stringify({ error: 'Missing query parameters' })
      };
    }
    
    // const { phone, friendlyName } = params;
    let phone = params.phone;
    const friendlyName = params.friendlyName;
    // Check if phone and friendlyName are provided
    if (!phone || !friendlyName) {
      return {
        statusCode: 400,
        headers: { "Content-Type": 'application/json' },
        body: JSON.stringify({ error: 'phone and friendlyName parameters are required' })
      };
    }
    // Add the snippet here
    if (phone.startsWith(' ')) {
      phone = phone.replace(/^ /, '+');
    }
    
    let theBaseURL = `https://${friendlyName}.engage.cience.com`;
    
    // const connectionToRDS = await connectToRDS();
    const connection = await connectToFriendlyDB(friendlyName);
    const {id: contactId, isMultiple, company} = await executeQuery(connection, phone);
    
    if (!contactId) {
      return {
        statusCode: 404,
        headers: { "Content-Type": 'application/json' },
        isBase64Encoded: false,
        body: JSON.stringify({ status: 'The caller was not found' })
      };
    }
    
    let redirectUrl;
    if (isMultiple) {
      redirectUrl = `${theBaseURL}/s/companies?search=${company}`;
    }
    
    if (contactId && !isMultiple) {
      redirectUrl = `${theBaseURL}/s/contacts/view/${contactId}`;
    }
    
    console.log("Redirecting to " + redirectUrl);
    return {
      statusCode: 302,
      headers: { "Location": redirectUrl, 'Content-Type': 'application/json' },
      isBase64Encoded: false,
      body: ""
    };
  } catch (error) {
    console.error(`Error processing request: ${error.message}`);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message })
    };
  }
})
